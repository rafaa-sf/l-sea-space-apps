/**
 * Worker thread for the Monte Carlo logic harness.
 *
 * Loads the real repository modules once (core barrel + real data services with
 * the file-backed fetchImpl), then executes deterministic scenario chunks sent
 * by `logic-mc.mjs` and returns the per-case check results.
 *
 * @module logic/logic-worker
 */
import { parentPort, workerData } from 'node:worker_threads'
import { createFileFetch } from './lib/file-fetch.mjs'
import { runCase } from './lib/checks.mjs'

const repo = workerData.repo
const dataRoot = workerData.dataRoot
const fetchImpl = createFileFetch(repo)

const core = await import(`${repo}/src/core/index.js`)
const lola = await import(`${repo}/src/services/lola.js`)
const sitesService = await import(`${repo}/src/services/sites.js`)
const horizons = await import(`${repo}/src/services/horizons.js`)

const pois = await sitesService.loadSites({ fetchImpl, dataRoot })
const terrains = await lola.loadTerrainRegions({ fetchImpl, dataRoot })
const ephemerisBySite = await horizons.loadEphemerisMap(
  pois.map((poi) => poi.id),
  { fetchImpl, dataRoot },
)

function terrainForScenario(scenario) {
  if (scenario.degraded === 'no-terrain' || scenario.degraded === 'both') return null
  return (
    terrains.find((terrain) => terrain.id === scenario.regionId) ??
    terrains.find((terrain) => core.isInsideTerrain(terrain, scenario.site.lat, scenario.site.lon)) ??
    null
  )
}

function datasetForScenario(scenario) {
  if (scenario.degraded === 'no-ephemeris' || scenario.degraded === 'both') return null
  return ephemerisBySite.get(scenario.datasetSiteId) ?? null
}

parentPort.on('message', (message) => {
  if (message.type !== 'work') return
  const results = []
  for (const scenario of message.scenarios) {
    results.push(
      runCase({
        core,
        scenario,
        terrain: terrainForScenario(scenario),
        terrains,
        dataset: datasetForScenario(scenario),
        pois,
        ephemerisBySite,
      }),
    )
  }
  parentPort.postMessage({ type: 'done', jobId: message.jobId, results })
})

parentPort.postMessage({
  type: 'ready',
  pois: pois.length,
  terrains: terrains.map((terrain) => terrain.id),
  ephemerides: ephemerisBySite.size,
})
