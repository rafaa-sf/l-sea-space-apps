// Throwaway timing probe for the Monte Carlo logic harness (not a deliverable).
import { createFileFetch } from './lib/file-fetch.mjs'

const REPO = new URL('../../', import.meta.url).pathname
const core = await import(REPO + 'src/core/index.js')
const lola = await import(REPO + 'src/services/lola.js')
const sites = await import(REPO + 'src/services/sites.js')
const horizons = await import(REPO + 'src/services/horizons.js')

const fetchImpl = createFileFetch(REPO)
const dataRoot = '/data/'

const t0 = performance.now()
const pois = await sites.loadSites({ fetchImpl, dataRoot })
const regions = await lola.loadTerrainRegions({ fetchImpl, dataRoot })
const eph = await horizons.loadEphemerisMap(pois.map((p) => p.id), { fetchImpl, dataRoot })
const tLoad = performance.now() - t0
console.log(`loaded: ${pois.length} POIs, ${regions.length} terrains (${regions.map((r) => r.id).join(', ')}), ${eph.size} ephemerides in ${tLoad.toFixed(0)} ms`)

// random helpers
let s = 20261114
const rnd = () => {
  s = (s + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const randIn = (a, b) => a + (b - a) * rnd()

function terrainFor(lat, lon) {
  return regions.find((r) => core.isInsideTerrain(r, lat, lon)) ?? null
}
function datasetFor(lat, lon) {
  let best = null
  let bestDist = Infinity
  for (const poi of pois) {
    const d = core.greatCircleDistanceM(lat, lon, poi.lat, poi.lon)
    if (d < bestDist) {
      bestDist = d
      best = poi
    }
  }
  return eph.get(best.id)
}

const mission = {
  missionDays: 14,
  powerNeedW: 180,
  sunDaysNeeded: 10,
  perimeterM: 200,
  mastM: 10,
  relayInOrbit: false,
  startTime: '2026-11-14T00:00:00Z',
}

for (const azCount of [72, 36]) {
  const m = { ...mission, profileStepDeg: 360 / azCount }
  let total = 0
  const N = 20
  for (let i = 0; i < N; i++) {
    // alternate regions: hi region centre-ish vs wide
    const useWide = i % 2 === 1
    const lat = useWide ? randIn(-87, -80.5) : randIn(-90, -87.5)
    const lon = randIn(0, 360)
    const terrain = terrainFor(lat, lon)
    const dataset = datasetFor(lat, lon)
    const site = { id: `rnd-${i}`, name: 'rnd', lat, lon }
    const t = performance.now()
    core.scoreSite({ site, terrain: [terrain], ephemeris: dataset, mission: m })
    total += performance.now() - t
  }
  console.log(`scoreSite ${azCount} az: ${(total / N).toFixed(1)} ms/case (mean of ${N})`)
}
