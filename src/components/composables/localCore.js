/**
 * Self-contained fallback implementations of the domain functions documented in
 * docs/architecture.md. The UI prefers the module implementations in
 * `src/core/` when they are available (see `useCompute.js`); this file keeps the
 * demo fully functional when a core module is missing or throws, and provides
 * the terrain/ephemeris placeholders used while `public/data` is incomplete.
 *
 * All angles are degrees unless the name says otherwise. Distances are meters,
 * times are ISO-8601 UTC strings.
 */

export const MOON_RADIUS_M = 1737400

/** Linear interpolation helper. */
export function lerp(a, b, t) {
  return a + (b - a) * t
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** Wrap an angle to the [0, 360) range. */
export function wrapDeg(deg) {
  const value = deg % 360
  return value < 0 ? value + 360 : value
}

/** Shortest signed angular difference `a - b` in degrees. */
export function angleDelta(a, b) {
  let delta = wrapDeg(a) - wrapDeg(b)
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  return delta
}

/* -------------------------------------------------------------------------- */
/* Terrain grid                                                               */
/* -------------------------------------------------------------------------- */

function base64ToBytes(base64) {
  if (typeof atob !== 'function') {
    throw new Error('base64 decoding is unavailable')
  }
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function decodeGridData(raw, grid) {
  if (Array.isArray(raw)) return Float32Array.from(raw, Number)
  if (ArrayBuffer.isView(raw)) return Float32Array.from(raw)

  if (typeof raw !== 'string') return null

  // Tolerate data URLs as well as bare base64 payloads.
  const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw
  const bytes = base64ToBytes(base64)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const type = String(grid.dtype || grid.encoding || 'float32').toLowerCase()
  const scale = Number(grid.scale ?? 1)
  const offset = Number(grid.offset ?? 0)
  const bytesPerSample = type === 'int16' || type === 'uint16' ? 2 : type === 'int32' ? 4 : 4
  const count = Math.floor(bytes.byteLength / bytesPerSample)
  const out = new Float32Array(count)

  for (let i = 0; i < count; i += 1) {
    const at = i * bytesPerSample
    let value
    if (type === 'int16') value = view.getInt16(at, true)
    else if (type === 'uint16') value = view.getUint16(at, true)
    else if (type === 'int32') value = view.getInt32(at, true)
    else value = view.getFloat32(at, true)
    out[i] = value * scale + offset
  }
  return out
}

/**
 * Normalise a terrain object received from a loader (JSON) into the documented
 * `{ width, height, lat0, lon0, lat1, lon1, datum, data: Float32Array }` shape.
 * Returns `null` when the input cannot be interpreted as a grid.
 */
export function normalizeTerrain(raw) {
  if (!raw || typeof raw !== 'object') return null
  const grid = raw.terrain && typeof raw.terrain === 'object' ? raw.terrain : raw

  const width = Math.round(Number(grid.width ?? grid.cols ?? grid.ncols))
  const height = Math.round(Number(grid.height ?? grid.rows ?? grid.nrows))
  const rawData = grid.data ?? grid.values ?? grid.elevations ?? grid.dem
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) return null
  if (rawData == null) return null

  let data
  try {
    data = decodeGridData(rawData, grid)
  } catch {
    return null
  }
  if (!data || data.length < width * height) return null

  let lat0 = Number(grid.lat0 ?? grid.minLat ?? grid.south ?? -90)
  let lat1 = Number(grid.lat1 ?? grid.maxLat ?? grid.north ?? -80)
  let lon0 = Number(grid.lon0 ?? grid.minLon ?? grid.west ?? 0)
  let lon1 = Number(grid.lon1 ?? grid.maxLon ?? grid.east ?? 360)
  const datum = Number(grid.datum ?? grid.referenceRadius ?? MOON_RADIUS_M)

  if (![lat0, lat1, lon0, lon1, datum].every(Number.isFinite)) return null
  if (lat1 < lat0) [lat0, lat1] = [lat1, lat0]
  if (lon1 < lon0) [lon0, lon1] = [lon1, lon0]
  // Normalise longitudes into a 0..360 window when the producer used ±180.
  if (lon0 < 0) {
    lon0 = wrapDeg(lon0)
    lon1 = lon0 + (lon1 - lon0)
  }

  return {
    width,
    height,
    lat0,
    lon0,
    lat1,
    lon1,
    datum: datum || MOON_RADIUS_M,
    data,
    rowZeroIsSouth: Boolean(grid.rowZeroIsSouth ?? true),
  }
}

/**
 * True when the terrain is a polar-stereographic planar grid: the format
 * produced by the LOLA acquisition scripts (`index.json` + int16 `.bin`).
 * Coordinates follow `rho = 2R tan(pi/4 + lat/2)`, `x = rho sin(lon)`,
 * `y = rho cos(lon)`, row 0 = maxY, col 0 = minX.
 */
export function isPlanarTerrain(terrain) {
  if (!terrain || typeof terrain !== 'object') return false
  return (
    terrain.kind === 'polar-stereographic' ||
    (Number.isFinite(Number(terrain.pixelSizeM)) &&
      Number.isFinite(Number(terrain.minX)) &&
      Number.isFinite(Number(terrain.maxY)))
  )
}

/**
 * Normalise a planar polar-stereographic grid (typed array data already in
 * meters, or base64/array payloads described by `grid`/`boundsM` metadata).
 */
export function normalizePlanarTerrain(raw) {
  if (!raw || typeof raw !== 'object') return null
  const meta = raw.grid && typeof raw.grid === 'object' ? { ...raw, ...raw.grid } : raw
  const width = Math.round(Number(meta.width))
  const height = Math.round(Number(meta.height))
  const pixelSizeM = Number(meta.pixelSizeM ?? meta.pixelSize)
  const bounds = meta.boundsM ?? {}
  const minX = Number(meta.minX ?? bounds.minX)
  const maxX = Number(meta.maxX ?? bounds.maxX)
  const minY = Number(meta.minY ?? bounds.minY)
  const maxY = Number(meta.maxY ?? bounds.maxY)
  const datum = Number(meta.referenceRadiusM ?? meta.datum ?? MOON_RADIUS_M)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) return null
  if (![pixelSizeM, minX, maxX, minY, maxY, datum].every(Number.isFinite)) return null

  const rawData = raw.data ?? meta.data ?? null
  if (rawData == null) return null
  let data
  if (rawData instanceof ArrayBuffer) {
    data = meta.dtype === 'float32' ? new Float32Array(rawData) : new Int16Array(rawData)
  } else if (ArrayBuffer.isView(rawData)) {
    data = rawData
  } else {
    data = decodeGridData(rawData, { ...meta, dtype: meta.dtype ?? 'int16', scale: meta.scale ?? 1, offset: meta.offset ?? 0 })
  }
  if (!data || data.length < width * height) return null

  const averageM = (minX + maxX) / 2
  const averageY = (minY + maxY) / 2
  const rhoMax = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY))
  const colatMax = (2 * Math.atan(rhoMax / (2 * datum)) * 180) / Math.PI
  return {
    kind: 'polar-stereographic',
    width,
    height,
    pixelSizeM,
    minX,
    maxX,
    minY,
    maxY,
    datum,
    referenceRadiusM: datum,
    data,
    lat0: -90,
    lon0: 0,
    lat1: colatMax - 90,
    lon1: 360,
    centerXM: averageM,
    centerYM: averageY,
    regionId: meta.id ?? raw.id ?? null,
    name: meta.name ?? raw.name ?? null,
    attribution: meta.attribution ?? 'NASA/GSFC/LOLA (PDS Geosciences Node)',
    elevationRangeM: meta.elevationRangeM ?? raw.elevationRangeM ?? null,
  }
}

/** Bilinear sample of a planar polar-stereographic grid (meters). */
export function samplePlanarElevation(terrain, lat, lon) {
  const { width, height, pixelSizeM, minX, maxY, data } = terrain
  const R = Number(terrain.datum) || MOON_RADIUS_M
  const rho = 2 * R * Math.tan(Math.PI / 4 + (Number(lat) * Math.PI) / 360)
  const lonRad = (Number(lon) * Math.PI) / 180
  const x = rho * Math.sin(lonRad)
  const y = rho * Math.cos(lonRad)
  const fx = clamp((x - minX) / pixelSizeM, 0, width - 1)
  const fy = clamp((maxY - y) / pixelSizeM, 0, height - 1)
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(x0 + 1, width - 1)
  const y1 = Math.min(y0 + 1, height - 1)
  const tx = fx - x0
  const ty = fy - y0
  const v00 = data[y0 * width + x0]
  const v10 = data[y0 * width + x1]
  const v01 = data[y1 * width + x0]
  const v11 = data[y1 * width + x1]
  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty)
}

/** Convert any supported terrain payload into the documented lat/lon grid. */
export function canonicalizeTerrain(raw, options = {}) {
  if (!raw) return null
  if (!isPlanarTerrain(raw)) {
    const latLonTerrain = normalizeTerrain(raw)
    return latLonTerrain ? reduceTerrain(latLonTerrain, options.maxSize ?? 256) : null
  }
  const planar = normalizePlanarTerrain(raw)
  if (!planar) return null
  const size = Math.max(32, Math.min(options.maxSize ?? 256, 512))
  const width = size
  const height = size
  const lat0 = -90
  const lat1 = planar.lat1
  const lon0 = 0
  const lon1 = 360
  const data = new Float32Array(width * height)
  for (let row = 0; row < height; row += 1) {
    const lat = lat0 + ((lat1 - lat0) * row) / (height - 1)
    for (let col = 0; col < width; col += 1) {
      const lon = lon0 + ((lon1 - lon0) * col) / (width - 1)
      data[row * width + col] = samplePlanarElevation(planar, lat, lon)
    }
  }
  return {
    width,
    height,
    lat0,
    lon0,
    lat1,
    lon1,
    datum: planar.datum,
    data,
    rowZeroIsSouth: true,
    canonical: true,
    source: planar.regionId ?? 'polar-stereographic',
    name: planar.name,
    attribution: planar.attribution,
    elevationRangeM: planar.elevationRangeM,
  }
}

/** Downsample a terrain grid so sampling stays cheap in the browser. */
export function reduceTerrain(terrain, maxSize = 256) {
  if (!terrain || (terrain.width <= maxSize && terrain.height <= maxSize)) return terrain
  const step = Math.ceil(Math.max(terrain.width, terrain.height) / maxSize)
  const width = Math.floor((terrain.width - 1) / step) + 1
  const height = Math.floor((terrain.height - 1) / step) + 1
  const data = new Float32Array(width * height)
  for (let row = 0; row < height; row += 1) {
    const sourceRow = Math.min(row * step, terrain.height - 1)
    for (let col = 0; col < width; col += 1) {
      const sourceCol = Math.min(col * step, terrain.width - 1)
      data[row * width + col] = terrain.data[sourceRow * terrain.width + sourceCol]
    }
  }
  return {
    ...terrain,
    width,
    height,
    lon0: terrain.lon0,
    lon1: terrain.lon1,
    originalWidth: terrain.width,
    originalHeight: terrain.height,
    data,
  }
}

/** Bilinear elevation sample from a terrain grid (meters). */
export function sampleElevation(terrain, lat, lon) {
  if (!terrain || !terrain.data) return 0
  if (isPlanarTerrain(terrain)) return samplePlanarElevation(terrain, lat, lon)
  const { width, height, lat0, lon0, lat1, lon1, data } = terrain
  if (lat1 === lat0 || lon1 === lon0) return data[0] || 0
  const latSpan = lat1 - lat0
  const lonSpan = lon1 - lon0
  const lonWraps = lonSpan >= 359.5
  let lonNorm = wrapDeg(lon - lon0)
  if (lonNorm > lonSpan && !lonWraps) lonNorm = lonSpan
  const lonFrac = clamp(lonNorm / lonSpan, 0, 1)
  const latFrac = clamp((lat - lat0) / latSpan, 0, 1)

  const fx = lonFrac * (width - 1)
  const fy = latFrac * (height - 1)
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(x0 + 1, width - 1)
  const y1 = Math.min(y0 + 1, height - 1)
  const tx = fx - x0
  const ty = fy - y0

  const v00 = data[y0 * width + x0]
  const v10 = data[y0 * width + x1]
  const v01 = data[y1 * width + x0]
  const v11 = data[y1 * width + x1]
  const top = lerp(v00, v10, tx)
  const bottom = lerp(v01, v11, tx)
  return lerp(top, bottom, ty)
}

/** Local slope and aspect at a coordinate. Aspect is the downhill azimuth. */
export function slopeAt(terrain, lat, lon) {
  const stepM = 250
  const dLat = (stepM / (MOON_RADIUS_M * Math.PI / 180)) * (lat >= 0 ? 1 : 1)
  const cosLat = Math.cos((lat * Math.PI) / 180) || 0.01
  const dLon = dLat / cosLat
  const north = sampleElevation(terrain, lat + dLat, lon)
  const south = sampleElevation(terrain, lat - dLat, lon)
  const east = sampleElevation(terrain, lat, lon + dLon)
  const west = sampleElevation(terrain, lat, lon - dLon)
  const dzDx = (east - west) / (2 * stepM)
  const dzDy = (north - south) / (2 * stepM)
  const slopeDeg = (Math.atan(Math.hypot(dzDx, dzDy)) * 180) / Math.PI
  // Downhill direction: opposite of the gradient.
  const aspectDeg = wrapDeg((Math.atan2(-dzDx, -dzDy) * 180) / Math.PI)
  return { slopeDeg, aspectDeg }
}

/**
 * Very small local-minima crater detector used only when
 * `src/core/terrain.js#findCraters` is unavailable.
 */
export function findCraters(terrain, options = {}) {
  if (!terrain) return []
  const limit = options.limit ?? 8
  const stride = Math.max(1, Math.floor((terrain.width * terrain.height) / 9000))
  const candidates = []
  const { width, height } = terrain
  const planar = isPlanarTerrain(terrain)

  for (let row = 2; row < height - 2; row += stride) {
    for (let col = 2; col < width - 2; col += stride) {
      const index = row * width + col
      const value = terrain.data[index]
      let isMin = true
      for (let dy = -1; dy <= 1 && isMin; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue
          if (terrain.data[(row + dy) * width + (col + dx)] < value) {
            isMin = false
            break
          }
        }
      }
      if (!isMin) continue
      const ring = Math.max(2, Math.round(Math.min(width, height) * 0.02))
      const rim = Math.max(
        terrain.data[clamp(row + ring, 0, height - 1) * width + col],
        terrain.data[clamp(row - ring, 0, height - 1) * width + col],
      )
      const depthM = Math.max(0, rim - value)
      if (depthM < 150) continue
      let lat
      let lon
      let diameterM
      if (planar) {
        const x = terrain.minX + col * terrain.pixelSizeM
        const y = terrain.maxY - row * terrain.pixelSizeM
        const rho = Math.hypot(x, y)
        lat = (2 * Math.atan(rho / (2 * terrain.datum)) - Math.PI / 2) * (180 / Math.PI)
        lon = wrapDeg((Math.atan2(x, y) * 180) / Math.PI)
        diameterM = ring * 2 * terrain.pixelSizeM
      } else {
        lat = terrain.lat0 + ((terrain.lat1 - terrain.lat0) * row) / (height - 1)
        lon = terrain.lon0 + ((terrain.lon1 - terrain.lon0) * col) / (width - 1)
        diameterM = Math.max(2000, (ring * 2 * (Math.abs(terrain.lon1 - terrain.lon0) * MOON_RADIUS_M * Math.PI) / 180) / (width - 1))
      }
      candidates.push({ lat, lon, diameterM, depthM })
    }
  }

  candidates.sort((a, b) => b.depthM - a.depthM)
  return candidates.slice(0, limit)
}

/* -------------------------------------------------------------------------- */
/* Horizon, visibility and ray tracing                                        */
/* -------------------------------------------------------------------------- */

function curvatureDrop(distanceM) {
  return (distanceM * distanceM) / (2 * MOON_RADIUS_M)
}

/** Maximum terrain elevation angle along an azimuth, with lunar curvature. */
export function horizonAngle(terrain, site, azimuthDeg) {
  if (!terrain || !site) return 0
  const az = (azimuthDeg * Math.PI) / 180
  const siteElev = sampleElevation(terrain, site.lat, site.lon)
  const maxRangeM = Math.min(420000, terrainSpanMeters(terrain))
  let maxAngle = -90
  for (let distance = 250; distance <= maxRangeM; distance += 500) {
    const northM = Math.cos(az) * distance
    const eastM = Math.sin(az) * distance
    const dLat = (northM / MOON_RADIUS_M) * (180 / Math.PI)
    const cosLat = Math.max(0.01, Math.cos((site.lat * Math.PI) / 180))
    const dLon = (eastM / (MOON_RADIUS_M * cosLat)) * (180 / Math.PI)
    const elevation = sampleElevation(terrain, site.lat + dLat, site.lon + dLon)
    const angle = (Math.atan2(elevation - siteElev - curvatureDrop(distance), distance) * 180) / Math.PI
    if (angle > maxAngle) maxAngle = angle
  }
  return maxAngle
}

/** Terrain extent in meters (roughly) for ray length limits. */
export function terrainSpanMeters(terrain) {
  if (!terrain) return 420000
  if (isPlanarTerrain(terrain)) {
    const span = 2 * Math.max(Math.abs(terrain.minX), Math.abs(terrain.maxX), Math.abs(terrain.minY), Math.abs(terrain.maxY))
    return span > 0 ? span : 420000
  }
  const latSpan = Math.abs(terrain.lat1 - terrain.lat0)
  const midLat = (terrain.lat0 + terrain.lat1) / 2
  const lonSpan = Math.abs(terrain.lon1 - terrain.lon0) * Math.cos((midLat * Math.PI) / 180)
  const span = (Math.max(latSpan, lonSpan) * Math.PI * MOON_RADIUS_M) / 180
  return span > 0 ? span : 420000
}

/** Trace a ray from the site and return the terrain intersection, if any. */
export function rayTerrainIntersection(terrain, site, azimuthDeg, elevationDeg) {
  if (!terrain || !site) return null
  const az = (azimuthDeg * Math.PI) / 180
  const el = (elevationDeg * Math.PI) / 180
  const siteElev = sampleElevation(terrain, site.lat, site.lon)
  const maxRangeM = Math.min(420000, terrainSpanMeters(terrain))
  const tanEl = Math.tan(el)

  for (let distance = 250; distance <= maxRangeM; distance += 500) {
    const northM = Math.cos(az) * distance
    const eastM = Math.sin(az) * distance
    const dLat = (northM / MOON_RADIUS_M) * (180 / Math.PI)
    const cosLat = Math.max(0.01, Math.cos((site.lat * Math.PI) / 180))
    const dLon = (eastM / (MOON_RADIUS_M * cosLat)) * (180 / Math.PI)
    const lat = site.lat + dLat
    const lon = site.lon + dLon
    const terrainElev = sampleElevation(terrain, lat, lon)
    const rayElev = siteElev + distance * tanEl - curvatureDrop(distance)
    if (rayElev <= terrainElev) {
      return { distanceM: distance, lat, lon }
    }
  }
  return null
}

export function isSunVisible(terrain, site, sun) {
  if (!sun) return false
  return sun.el > horizonAngle(terrain, site, sun.az)
}

export function isEarthVisible(terrain, site, earth) {
  if (!earth) return false
  return earth.el > horizonAngle(terrain, site, earth.az)
}

/* -------------------------------------------------------------------------- */
/* Ephemeris                                                                  */
/* -------------------------------------------------------------------------- */

const SYNTHETIC_START = Date.parse('2026-11-01T00:00:00Z')
const SYNTHETIC_STEP_MS = 3600 * 1000
const SYNTHETIC_DAYS = 61
const SYNODIC_DAYS = 29.53059

/**
 * Placeholder ephemeris model used when `public/data/ephemeris/<site>.json` is
 * not available. It reproduces the qualitative south-pole behaviour (the Sun
 * circles the horizon once per synodic month; the Earth librates around a low
 * elevation) so every panel stays explorable during development.
 */
export function createSyntheticEphemeris(site = {}, options = {}) {
  const start = options.start ?? SYNTHETIC_START
  const count = options.count ?? (SYNTHETIC_DAYS * 24) / 1
  const phase = ((site.lon ?? 0) * Math.PI) / 180
  const samples = []
  for (let i = 0; i < count; i += 1) {
    const time = new Date(start + i * SYNTHETIC_STEP_MS)
    const monthAngle = ((2 * Math.PI * (i / 24)) / SYNODIC_DAYS) + phase
    const sunAz = wrapDeg((monthAngle * 180) / Math.PI)
    const sunEl = 1.2 * Math.sin(monthAngle + Math.PI / 2) - 0.6
    const earthAz = wrapDeg(180 + 8 * Math.sin((2 * Math.PI * (i / 24)) / 27.31))
    const earthEl = 5.5 + 3.5 * Math.sin((2 * Math.PI * (i / 24)) / 27.21 + 0.8)
    samples.push({
      time: time.toISOString(),
      sun: { az: Number(sunAz.toFixed(3)), el: Number(sunEl.toFixed(3)) },
      earth: { az: Number(earthAz.toFixed(3)), el: Number(earthEl.toFixed(3)) },
    })
  }
  return {
    siteId: site.id ?? 'synthetic',
    source: 'synthetic',
    start: samples[0].time,
    end: samples[samples.length - 1].time,
    samples,
  }
}

/** Normalise a raw ephemeris payload (array or wrapped object). */
export function normalizeEphemeris(raw, siteId = null) {
  if (!raw) return null
  const list = Array.isArray(raw)
    ? raw
    : raw.samples ?? raw.data ?? raw.points ?? raw.values ?? raw.ephemeris
  if (!Array.isArray(list) || list.length < 2) return null

  const samples = []
  for (const entry of list) {
    if (!entry) continue
    const time = Date.parse(entry.time ?? entry.utc ?? entry.t ?? entry.date)
    const sun = entry.sun ?? {}
    const earth = entry.earth ?? entry.selene ?? {}
    const sunAz = Number(sun.az ?? sun.azimuth ?? sun.azDeg)
    const sunEl = Number(sun.el ?? sun.elevation ?? sun.elDeg)
    const earthAz = Number(earth.az ?? earth.azimuth ?? earth.azDeg)
    const earthEl = Number(earth.el ?? earth.elevation ?? earth.elDeg)
    if (!Number.isFinite(time) || ![sunAz, sunEl, earthAz, earthEl].every(Number.isFinite)) continue
    samples.push({ time: new Date(time).toISOString(), sun: { az: sunAz, el: sunEl }, earth: { az: earthAz, el: earthEl } })
  }
  if (samples.length < 2) return null
  samples.sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
  return {
    siteId: siteId ?? raw.siteId ?? raw.site ?? null,
    source: raw.source ?? 'horizons',
    start: samples[0].time,
    end: samples[samples.length - 1].time,
    samples,
  }
}

function findBracket(times, target) {
  let low = 0
  let high = times.length - 1
  if (target <= times[0]) return [0, 1]
  if (target >= times[high]) return [high - 1, high]
  while (high - low > 1) {
    const mid = (low + high) >> 1
    if (times[mid] <= target) low = mid
    else high = mid
  }
  return [low, high]
}

function lerpAngle(a, b, t) {
  return wrapDeg(a + angleDelta(b, a) * t)
}

/** Linear interpolation of the Sun and Earth topocentric az/el at `date`. */
export function sampleAt(dataset, date) {
  if (!dataset || !dataset.samples || dataset.samples.length === 0) {
    return { time: new Date(date).toISOString(), sun: { az: 0, el: 0 }, earth: { az: 0, el: 0 } }
  }
  const target = typeof date === 'number' ? date : Date.parse(date)
  const times = dataset._times ?? (dataset._times = dataset.samples.map((s) => Date.parse(s.time)))
  const [i0, i1] = findBracket(times, target)
  const s0 = dataset.samples[i0]
  const s1 = dataset.samples[i1]
  const span = times[i1] - times[i0]
  const t = span > 0 ? clamp((target - times[i0]) / span, 0, 1) : 0
  return {
    time: new Date(target).toISOString(),
    sun: { az: lerpAngle(s0.sun.az, s1.sun.az, t), el: lerp(s0.sun.el, s1.sun.el, t) },
    earth: { az: lerpAngle(s0.earth.az, s1.earth.az, t), el: lerp(s0.earth.el, s1.earth.el, t) },
  }
}

function bodyAt(sample, body) {
  return body === 'earth' ? sample.earth : sample.sun
}

/**
 * Find the next set (or rise, when `mode: 'rise'`) event for `body`. The event
 * compares the body elevation against the local terrain horizon, so a crater
 * floor sees an earlier sunset than a ridge.
 */
export function nextSetEvent(dataset, site, terrain, body = 'sun', from = new Date(), options = {}) {
  if (!dataset) return null
  const mode = options.mode ?? 'set'
  const fromMs = typeof from === 'number' ? from : Date.parse(from)
  const horizonCache = new Map()
  const horizonFor = (az) => {
    const bucket = Math.round(wrapDeg(az) / 3) * 3
    if (!horizonCache.has(bucket)) horizonCache.set(bucket, horizonAngle(terrain, site, bucket))
    return horizonCache.get(bucket)
  }

  let previous = null
  let stepMs = 5 * 60 * 1000
  const maxMs = 40 * 24 * 3600 * 1000
  for (let ms = fromMs; ms <= fromMs + maxMs; ms += stepMs) {
    const sample = sampleAt(dataset, ms)
    const bodyState = bodyAt(sample, body)
    const horizon = horizonFor(bodyState.az)
    const visible = bodyState.el > horizon
    if (previous === null) {
      previous = visible
      continue
    }
    const isEvent = mode === 'set' ? previous && !visible : !previous && visible
    if (isEvent) {
      // Refine with a 30 s bisection between the two bracketing samples.
      let lo = ms - stepMs
      let hi = ms
      for (let i = 0; i < 6; i += 1) {
        const mid = (lo + hi) / 2
        const midSample = sampleAt(dataset, mid)
        const midState = bodyAt(midSample, body)
        const midVisible = midState.el > horizonFor(midState.az)
        if (mode === 'set' ? midVisible : !midVisible) lo = mid
        else hi = mid
      }
      const eventMs = Math.round((lo + hi) / 2)
      return {
        time: new Date(eventMs).toISOString(),
        remainingSeconds: Math.max(0, Math.round((eventMs - fromMs) / 1000)),
        body,
      }
    }
    previous = visible
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* Power, communications and autopilot                                        */
/* -------------------------------------------------------------------------- */

const PANEL_AREA_M2 = 2.4
const PANEL_EFFICIENCY = 0.28
const SOLAR_CONSTANT_W_M2 = 1361

/** Solar power estimate over the mission window. */
export function solarPowerEstimate(site, terrain, ephemeris, mission = {}) {
  const missionDays = mission.missionDays ?? 14
  const needW = mission.powerNeedW ?? 120
  const start = mission.startTime
    ? Date.parse(mission.startTime)
    : ephemeris
      ? Date.parse(ephemeris.start)
      : Date.now()
  const samples = 96
  const step = (missionDays * 24 * 3600 * 1000) / samples
  let sumW = 0
  let peakW = 0
  let litSamples = 0
  const horizonCache = new Map()
  const horizonFor = (az) => {
    const bucket = Math.round(wrapDeg(az) / 3) * 3
    if (!horizonCache.has(bucket)) horizonCache.set(bucket, horizonAngle(terrain, site, bucket))
    return horizonCache.get(bucket)
  }
  for (let i = 0; i < samples; i += 1) {
    const sample = sampleAt(ephemeris, start + i * step)
    const horizon = horizonFor(sample.sun.az)
    const visible = sample.sun.el > horizon
    const incidence = visible ? Math.max(0, Math.cos((Math.max(0, sample.sun.el) * Math.PI) / 180)) : 0
    const power = SOLAR_CONSTANT_W_M2 * PANEL_AREA_M2 * PANEL_EFFICIENCY * incidence
    if (visible) litSamples += 1
    sumW += power
    if (power > peakW) peakW = power
  }
  const averageW = sumW / samples
  return {
    averageW,
    peakW,
    dailyWh: averageW * 24,
    needW,
    marginW: averageW - needW,
    illuminatedFraction: litSamples / samples,
    panelAreaM2: PANEL_AREA_M2,
    efficiency: PANEL_EFFICIENCY,
  }
}

/** Merge visible-sample runs into Earth visibility windows. */
export function commWindows(site, terrain, ephemeris, mission = {}, from, to) {
  if (!ephemeris) return []
  const startMs = Date.parse(from ?? mission.startTime ?? ephemeris.start)
  const endMs = Date.parse(to ?? new Date(startMs + 7 * 24 * 3600 * 1000))
  const relay = Boolean(mission.relayInOrbit)
  const stepMs = 5 * 60 * 1000
  const windows = []
  let open = null
  const horizonCache = new Map()
  const horizonFor = (az) => {
    const bucket = Math.round(wrapDeg(az) / 3) * 3
    if (!horizonCache.has(bucket)) horizonCache.set(bucket, horizonAngle(terrain, site, bucket))
    return horizonCache.get(bucket)
  }
  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    const sample = sampleAt(ephemeris, ms)
    const horizon = horizonFor(sample.earth.az)
    const visible = relay || sample.earth.el > horizon
    if (visible && open === null) open = ms
    if (!visible && open !== null) {
      if (ms - open >= 10 * 60 * 1000) windows.push({ from: new Date(open).toISOString(), to: new Date(ms).toISOString() })
      open = null
    }
  }
  if (open !== null) windows.push({ from: new Date(open).toISOString(), to: new Date(endMs).toISOString() })
  return windows
}

/** Communication data budget for a set of windows. */
export function dataBudget(windows = [], mission = {}) {
  const bitrateMbps = mission.bitrateMbps ?? 2
  const totalSeconds = windows.reduce((sum, w) => sum + Math.max(0, (Date.parse(w.to) - Date.parse(w.from)) / 1000), 0)
  return { totalSeconds, estimatedMb: (totalSeconds * bitrateMbps) / 8, bitrateMbps }
}

const SCORE_WEIGHTS = { sunlight: 0.4, power: 0.25, comms: 0.2, terrain: 0.15 }

/** Score and rank candidate sites with human-readable reason codes. */
export function rankSites({ sites = [], terrain, ephemeris, mission = {} } = {}) {
  const missionDays = mission.missionDays ?? 14
  const powerNeedW = mission.powerNeedW ?? 120
  const sunDaysNeeded = mission.sunDaysNeeded ?? 10
  const from = mission.startTime ?? (ephemeris ? ephemeris.start : new Date().toISOString())
  const to = new Date(Date.parse(from) + missionDays * 24 * 3600 * 1000).toISOString()

  const scores = sites.map((site) => {
    const sun = solarPowerEstimate(site, terrain, ephemeris, mission)
    const windows = commWindows(site, terrain, ephemeris, mission, from, to)
    const budget = dataBudget(windows, mission)
    const slope = slopeAt(terrain, site.lat, site.lon)
    const reasons = []

    const sunlightDays = sun.illuminatedFraction * missionDays
    const sunlightScore = clamp(sunlightDays / Math.max(1, sunDaysNeeded), 0, 1)
    if (sunlightDays >= sunDaysNeeded) {
      reasons.push({ code: 'sunlightMet', params: { days: sunlightDays.toFixed(1), need: sunDaysNeeded } })
    } else {
      reasons.push({ code: 'sunlightShort', params: { days: sunlightDays.toFixed(1), need: sunDaysNeeded } })
    }

    const powerScore = clamp(sun.averageW / Math.max(1, powerNeedW), 0, 1)
    if (sun.averageW >= powerNeedW) {
      reasons.push({ code: 'powerMet', params: { watts: Math.round(sun.averageW), need: powerNeedW } })
    } else {
      reasons.push({ code: 'powerShort', params: { watts: Math.round(sun.averageW), need: powerNeedW } })
    }

    const commsHours = budget.totalSeconds / 3600
    const commsScore = clamp(commsHours / Math.max(1, missionDays * 24 * 0.25), 0, 1)
    if (windows.length > 0) {
      reasons.push({ code: 'commsWindows', params: { count: windows.length, hours: commsHours.toFixed(1) } })
    } else {
      reasons.push({ code: 'commsNone' })
    }

    const terrainScore = clamp(1 - slope.slopeDeg / 15, 0, 1)
    reasons.push({ code: 'slope', params: { degrees: slope.slopeDeg.toFixed(1) } })
    if (site.elevationM > 0) reasons.push({ code: 'elevated', params: { meters: Math.round(site.elevationM) } })

    const score =
      sunlightScore * SCORE_WEIGHTS.sunlight +
      powerScore * SCORE_WEIGHTS.power +
      commsScore * SCORE_WEIGHTS.comms +
      terrainScore * SCORE_WEIGHTS.terrain

    return {
      site,
      siteId: site.id,
      score: Math.round(score * 1000) / 10,
      sunlightDays,
      illuminatedFraction: sun.illuminatedFraction,
      averageW: sun.averageW,
      peakW: sun.peakW,
      commsWindows: windows.length,
      commsHours,
      estimatedMb: budget.estimatedMb,
      slopeDeg: slope.slopeDeg,
      reasons,
    }
  })

  return scores.sort((a, b) => b.score - a.score).map((score, index) => ({ ...score, rank: index + 1 }))
}

export function scoreSite(input) {
  return rankSites({ ...input, sites: [input.site] })[0] ?? null
}

/* -------------------------------------------------------------------------- */
/* Fallback terrain                                                           */
/* -------------------------------------------------------------------------- */

function gaussian(value, center, width) {
  const d = value - center
  return Math.exp(-(d * d) / (2 * width * width))
}

/**
 * Procedural south-pole terrain used until a real LOLA subset is available.
 * The relief is synthetic but visually plausible: a cratered polar cap with a
 * raised rim area near Shackleton.
 */
export function createFallbackTerrain(width = 160, height = 160) {
  const lat0 = -90
  const lat1 = -84.5
  const lon0 = 0
  const lon1 = 360
  const data = new Float32Array(width * height)

  // Craters defined by lat, lon, radius (km) and depth (m).
  const craters = [
    { lat: -89.9, lon: 0, radiusKm: 10.5, depthM: 3200 },
    { lat: -88.7, lon: 88, radiusKm: 17, depthM: 2200 },
    { lat: -88.9, lon: 274, radiusKm: 13, depthM: 1800 },
    { lat: -87.6, lon: 40, radiusKm: 11, depthM: 1400 },
    { lat: -86.4, lon: 205, radiusKm: 22, depthM: 2600 },
    { lat: -85.7, lon: 320, radiusKm: 18, depthM: 2000 },
    { lat: -87.1, lon: 150, radiusKm: 9, depthM: 1200 },
    { lat: -85.2, lon: 60, radiusKm: 15, depthM: 1700 },
  ]

  for (let row = 0; row < height; row += 1) {
    const lat = lat0 + ((lat1 - lat0) * row) / (height - 1)
    const colat = 90 + lat
    for (let col = 0; col < width; col += 1) {
      const lon = lon0 + ((lon1 - lon0) * col) / (width - 1)
      // Broad base: south pole terrain sits below the datum, rising outward.
      let elevation = -2800 + 260 * Math.pow(colat / 5.5, 2)
      elevation += 180 * Math.sin((lon * Math.PI) / 60) * Math.cos((lat * Math.PI) / 2)
      for (const crater of craters) {
        const dLon = angleDelta(lon, crater.lon)
        const northKm = ((lat - crater.lat) * Math.PI * MOON_RADIUS_M) / 180 / 1000
        const eastKm = ((dLon * Math.PI * MOON_RADIUS_M) / 180) * Math.cos((lat * Math.PI) / 180) / 1000
        const distanceKm = Math.hypot(northKm, eastKm)
        const profile = Math.exp(-Math.pow(distanceKm / (crater.radiusKm * 0.75), 2))
        elevation -= crater.depthM * profile
        // Rim ridge.
        const rim = gaussian(distanceKm, crater.radiusKm, crater.radiusKm * 0.22)
        elevation += crater.depthM * 0.35 * rim
      }
      data[row * width + col] = elevation
    }
  }

  return normalizeTerrain({ width, height, lat0, lon0, lat1, lon1, datum: MOON_RADIUS_M, data })
}

/** Pick readable synthetic terrain statistics (min/max/mean). */
export function terrainStats(terrain) {
  if (!terrain || !terrain.data) return null
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let count = 0
  for (let i = 0; i < terrain.data.length; i += 1) {
    const value = terrain.data[i]
    if (!Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
    sum += value
    count += 1
  }
  if (!count) return null
  return { minM: min, maxM: max, meanM: sum / count, reliefM: max - min }
}
