#!/usr/bin/env node
/**
 * Crater-avoidance Monte Carlo for the Autopilot "Avoid craters" toggle.
 *
 * For several DEM regions and detection settings it:
 *  - detects craters with the real `findCraters` (now requiring coherent rim
 *    support and using a robust median radius),
 *  - runs `detectLandingZones` with `avoidCraters` off/on and different
 *    clearance/min-diameter settings,
 *  - checks that no returned zone centroid falls inside a detected crater,
 *  - measures whether the detected "craters" are real depressions (inside mean
 *    elevation lower than the surrounding annulus) rather than peaks/slopes.
 *
 * Usage: node qa/autopilot/crater-avoid-mc.mjs
 */
import { dirname, resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createFileFetch } from '../logic/lib/file-fetch.mjs'

const HERE = dirname(new URL(import.meta.url).pathname)
const REPO = resolve(HERE, '..', '..')
const R = 1737400
const RAD = Math.PI / 180
const dest = (lat, lon, azDeg, d) => {
  const az = azDeg * RAD
  const lat1 = lat * RAD
  const lon1 = lon * RAD
  const dr = d / R
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(az))
  const lon2 = lon1 + Math.atan2(Math.sin(az) * Math.sin(dr) * Math.cos(lat1), Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: lat2 / RAD, lon: ((lon2 / RAD) % 360 + 360) % 360 }
}

async function main() {
  const fetchImpl = createFileFetch(REPO)
  const core = await import(`${REPO}/src/core/index.js`)
  const lola = await import(`${REPO}/src/services/lola.js`)
  const terrains = await lola.loadTerrainRegions({ fetchImpl, dataRoot: '/data/' })
  const sample = (terrain, lat, lon) => core.sampleElevation(terrain, lat, lon)
  const runs = []
  const failures = []
  const regions = ['south-pole-80s-80m', 'south-pole-875s-20m', 'south-pole-400km-1024px']
  for (const id of regions) {
    const terrain = terrains.find((t) => t.id === id)
    if (!terrain) continue
    const craters = core.findCraters(terrain)
    // Depression test: mean elevation inside the crater vs the surrounding annulus.
    let nonDepression = 0
    for (const c of craters) {
      const r = c.diameterM / 2
      const inside = []
      const outside = []
      for (const f of [0.2, 0.4, 0.6]) for (let a = 0; a < 8; a += 1) {
        const p = dest(c.lat, c.lon, a * 45, f * r)
        const e = sample(terrain, p.lat, p.lon)
        if (Number.isFinite(e)) inside.push(e)
      }
      for (const f of [1.2, 1.4, 1.6]) for (let a = 0; a < 8; a += 1) {
        const p = dest(c.lat, c.lon, a * 45, f * r)
        const e = sample(terrain, p.lat, p.lon)
        if (Number.isFinite(e)) outside.push(e)
      }
      if (!inside.length || !outside.length) continue
      const mi = inside.reduce((s, v) => s + v, 0) / inside.length
      const mo = outside.reduce((s, v) => s + v, 0) / outside.length
      if (mi > mo - 5) nonDepression += 1
    }
    const off = core.detectLandingZones(terrain, { maxZones: 6 })
    for (const [label, options] of [
      ['default', { avoidCraters: true }],
      ['clearance-300', { avoidCraters: true, craterClearanceM: 300 }],
      ['min-1200', { avoidCraters: true, craterMinDiameterM: 1200 }],
    ]) {
      const on = core.detectLandingZones(terrain, { maxZones: 6, ...options })
      const insideZones = on.zones.filter((zone) =>
        craters.some((c) => core.greatCircleDistanceM(zone.lat, zone.lon, c.lat, c.lon, R) < c.diameterM / 2),
      )
      if (insideZones.length) failures.push({ terrain: id, setting: label, kind: 'zone-inside-crater', detail: insideZones.map((z) => z.id) })
      if (!(on.meta.craterCellsExcluded > 0)) failures.push({ terrain: id, setting: label, kind: 'no-cells-excluded', detail: on.meta.cratersConsidered })
      runs.push({
        terrain: id,
        setting: label,
        craters: craters.length,
        nonDepression,
        nonDepressionPct: craters.length ? Number(((nonDepression / craters.length) * 100).toFixed(1)) : 0,
        zonesOff: off.zones.length,
        zonesOn: on.zones.length,
        cellsExcluded: on.meta.craterCellsExcluded,
        insideZones: insideZones.length,
      })
    }
    console.log(`${id}: ${craters.length} craters (${nonDepression} non-depression), zones ${off.zones.length}->${runs.filter((r) => r.terrain === id)[0].zonesOn}`)
  }
  const report = { generatedAt: new Date().toISOString(), runs, failures, failureCount: failures.length }
  mkdirSync(resolve(HERE, 'results'), { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  writeFileSync(resolve(HERE, 'results', `crater-avoid-mc-${stamp}.json`), JSON.stringify(report, null, 2))
  console.log('checks:', runs.length, '| failures:', failures.length)
  for (const f of failures.slice(0, 8)) console.log(' FAIL', JSON.stringify(f))
  console.log('RESULT:', failures.length ? 'FAILURES' : 'ALL PASS')
  process.exit(failures.length ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
