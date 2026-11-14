#!/usr/bin/env node
// L-SEA Space Apps - build public/data/pois.json from the curated site list.
//
// Elevations are sampled from the real LOLA DEM subsets that ship with the app
// (public/data/terrain/*.bin, produced by scripts/nasa/build-terrain.py from the
// PDS Geosciences LOLA polar gridded products). This keeps the site elevation
// consistent with the terrain grid used for horizon/visibility geometry.
//
// Usage: node scripts/nasa/build-pois.mjs

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SITE_GEOMETRY, MOON_RADIUS_M, SITES } from './sites.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DATA_DIR = path.join(ROOT, 'public', 'data')
const TERRAIN_DIR = path.join(DATA_DIR, 'terrain')

const NO_DATA = -32768

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polar stereographic (latitude of origin -90, central meridian 0) forward projection. */
function lonLatToXY(latDeg, lonDeg, radiusM) {
  const lat = (latDeg * Math.PI) / 180
  const lon = (((lonDeg % 360) + 360) % 360) * (Math.PI / 180)
  const rho = 2 * radiusM * Math.tan(Math.PI / 4 + lat / 2)
  return { x: rho * Math.sin(lon), y: rho * Math.cos(lon), rho }
}

async function loadRegion(region) {
  const meta = JSON.parse(await readFile(path.join(TERRAIN_DIR, region.meta), 'utf8'))
  const buffer = await readFile(path.join(TERRAIN_DIR, meta.grid.file))
  // Copy into an aligned buffer: Int16Array requires 2-byte alignment.
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  const data = new Int16Array(arrayBuffer)
  if (data.length !== meta.grid.width * meta.grid.height) {
    throw new Error(`${region.id}: expected ${meta.grid.width * meta.grid.height} samples, got ${data.length}`)
  }
  return { meta, data }
}

/** Bilinear elevation sample (meters) from an int16 terrain grid. */
function sampleElevation(grid, latDeg, lonDeg) {
  const { meta, data } = grid
  const g = meta.grid
  const { x, y } = lonLatToXY(latDeg, lonDeg, meta.referenceRadiusM ?? MOON_RADIUS_M)
  const col = (x - g.minX) / g.pixelSizeM
  const row = (g.maxY - y) / g.pixelSizeM
  if (col < 0 || row < 0 || col > g.width - 1 || row > g.height - 1) return null

  const c0 = Math.floor(col)
  const r0 = Math.floor(row)
  const c1 = Math.min(g.width - 1, c0 + 1)
  const r1 = Math.min(g.height - 1, r0 + 1)
  const fx = col - c0
  const fy = row - r0
  const at = (r, c) => data[r * g.width + c]
  const values = [
    [at(r0, c0), (1 - fx) * (1 - fy)],
    [at(r0, c1), fx * (1 - fy)],
    [at(r1, c0), (1 - fx) * fy],
    [at(r1, c1), fx * fy],
  ].filter(([v]) => v !== NO_DATA)
  if (values.length === 0) return null
  const weightSum = values.reduce((sum, [, w]) => sum + w, 0)
  if (weightSum <= 0) return null
  return values.reduce((sum, [v, w]) => sum + v * w, 0) / weightSum
}

async function main() {
  const index = JSON.parse(await readFile(path.join(TERRAIN_DIR, 'index.json'), 'utf8'))
  // Smallest pixel size first: prefer the highest-resolution region that covers
  // the site, fall back to the wide-area region for outer sites.
  const regions = [...index.regions].sort((a, b) => a.pixelSizeM - b.pixelSizeM)
  const grids = []
  for (const region of regions) {
    console.log(`loading terrain region ${region.id} (${region.width}x${region.height}, ${region.pixelSizeM} m/px)`)
    grids.push({ region, ...(await loadRegion(region)) })
  }

  const pois = SITES.map((site) => {
    let elevationM = null
    let elevationSource = null
    let usedRegion = null
    for (const grid of grids) {
      const value = sampleElevation(grid, site.lat, site.lon)
      if (value !== null) {
        elevationM = Math.round(value)
        elevationSource =
          `LOLA ${grid.meta.sourceFile} sampled at the site on the ` +
          `${grid.meta.grid.width}x${grid.meta.grid.height} app grid (${grid.meta.grid.pixelSizeM} m/px)`
        usedRegion = grid.region.id
        break
      }
    }
    if (elevationM === null) {
      console.warn(`  ! ${site.id}: no terrain coverage, elevationM left null`)
    }
    return {
      id: site.id,
      name: site.name,
      lat: round5(site.lat),
      lon: round5(((site.lon % 360) + 360) % 360),
      elevationM,
      perimeterM: DEFAULT_SITE_GEOMETRY.perimeterM,
      mastM: DEFAULT_SITE_GEOMETRY.mastM,
      source: 'poi',
      provenance: site.provenance,
      sourceUrl: site.sourceUrl,
      elevationSource,
      terrainRegion: usedRegion,
      description: site.note,
      note: site.note,
    }
  })

  const outFile = path.join(DATA_DIR, 'pois.json')
  await writeFile(outFile, JSON.stringify(pois, null, 2) + '\n', 'utf8')
  console.log(`wrote ${path.relative(ROOT, outFile)} (${pois.length} sites)`)
  for (const p of pois) {
    console.log(`  ${p.id.padEnd(24)} ${p.lat.toFixed(3)}S ${p.lon.toFixed(2)}E  elevation ${p.elevationM} m`)
  }
}

function round5(n) {
  return Math.round(n * 1e5) / 1e5
}

main().catch((error) => {
  console.error(`FAILED: ${error.message}`)
  process.exit(1)
})
