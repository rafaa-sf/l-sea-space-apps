#!/usr/bin/env node
// L-SEA Space Apps - local LOLA DEM downloader and terrain builder.
//
// Downloads the official PDS Geosciences LOLA polar DEM products, verifies their
// exact byte size and SHA-256, caches them under a gitignored local directory,
// and builds browser-ready terrain regions under public/data/terrain/ BEFORE the
// application renders. The application reads public/data/terrain/index.json and
// lists every region it contains in the DEM area selector, so a newly built
// region appears in the dropdown after the application reloads.
//
// Products (PDS Geosciences Node, LRO LOLA gridded data records, polar JP2):
//   ldem_875s_20m.jp2  21,462,406 B  covers 87.5S-90S at 20 m/px
//   ldem_80s_80m.jp2   29,837,992 B  covers 80S-90S at 80 m/px
//
// Usage:
//   npm run data:lola                                  # both standard regions
//   npm run data:lola -- --region=high-detail --size=1024
//   npm run data:lola -- --product=ldem_80s_80m --mpp=250
//   npm run data:lola -- --extent-km=400 --size=1024   # custom 400 km square
//   npm run data:lola -- --extent=-150000,-150000,150000,150000 --size=512
//   npm run data:lola -- --dry-run --region=both
//
// Options:
//   --region=high-detail|wide-area|both  standard regions (default both)
//   --product=ldem_875s_20m|ldem_80s_80m build one product's standard region
//   --size=<px>                          output grid size (default 2048/1024)
//   --mpp=<m/px>                         output resolution alternative to --size
//   --extent-km=<km>                     custom square extent centred on the pole
//   --extent=<minX,minY,maxX,maxY>       custom square extent in projected metres
//   --center-x=<m> --center-y=<m>        custom extent centre (default 0,0 = pole)
//   --id=<region-id>                     override the generated custom region id
//   --out-dir=<dir>                      terrain output directory
//   --cache-dir=<dir>                    download cache (default .cache/lola)
//   --force                              re-download even when the cache verifies
//   --overwrite                          replace an existing region whose bytes differ
//   --dry-run                            print the plan; no downloads, no writes
//   --help                               show this help
//
// Node.js 24 ESM, no runtime dependencies; rasterio work is delegated to
// scripts/nasa/lola_crop.py (Python 3, same metadata conventions as
// scripts/nasa/build-terrain.py).

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const HELPER = path.join(ROOT, 'scripts', 'nasa', 'lola_crop.py')
const REPO_TERRAIN = path.join(ROOT, 'public', 'data', 'terrain')
const REPO_INDEX = path.join(REPO_TERRAIN, 'index.json')
const BASE_URL =
  'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/jp2/'
const DEFAULT_CACHE = path.join(ROOT, '.cache', 'lola')
const DEFAULT_OUT = REPO_TERRAIN
const REFERENCE_RADIUS_M = 1737400
const USER_AGENT =
  'L-SEA-SpaceApps/1.0 (NASA Space Apps Challenge Malaga 2026; local LOLA DEM downloader)'

const DEFAULT_PROJECTION = {
  type: 'polar_stereographic',
  latitudeOfOriginDeg: -90,
  centralMeridianDeg: 0,
  referenceRadiusM: REFERENCE_RADIUS_M,
  formula: {
    lonLatToXY: 'rho = 2 * R * tan(pi/4 + lat/2); x = rho * sin(lon); y = rho * cos(lon)',
    xyToLonLat:
      'rho = hypot(x, y); lon = atan2(x, y); lat = 2 * atan(rho / (2 * R)) - pi/2',
    units: 'meters for x/y, radians inside formulas',
  },
}
const ATTRIBUTION = 'NASA/GSFC/LOLA (PDS Geosciences Node)'

/** Official products: exact size and SHA-256 are verified after download. */
const PRODUCTS = {
  ldem_875s_20m: {
    key: 'ldem_875s_20m',
    file: 'ldem_875s_20m.jp2',
    bytes: 21462406,
    sha256: 'fff7c2017a192788066a0867d78fd1ccf783216e26974b5e65287669aa472bac',
    label: 'LDEM_875S_20M',
    coverageM: 75840,
    spanM: 151680,
    defaultSize: 2048,
    standardRegion: {
      id: 'south-pole-875s-20m',
      name: 'Lunar south pole, 87.5S-90S (LOLA LDEM_875S_20M)',
      role: 'high-resolution',
    },
    regionAlias: 'high-detail',
  },
  ldem_80s_80m: {
    key: 'ldem_80s_80m',
    file: 'ldem_80s_80m.jp2',
    bytes: 29837992,
    sha256: 'c088dd4f510e879375ee7e6f0d320ba84115f535f45fb592dd7f83a7d2e83ae3',
    label: 'LDEM_80S_80M',
    coverageM: 304000,
    spanM: 608000,
    defaultSize: 1024,
    standardRegion: {
      id: 'south-pole-80s-80m',
      name: 'Lunar south pole, 80S-90S (LOLA LDEM_80S_80M)',
      role: 'wide-area',
    },
    regionAlias: 'wide-area',
  },
}
const PRODUCT_ORDER = ['ldem_875s_20m', 'ldem_80s_80m']
const REGION_ALIASES = { 'high-detail': 'ldem_875s_20m', 'wide-area': 'ldem_80s_80m' }

const USAGE = `Usage: npm run data:lola -- [options]

Download the official PDS Geosciences LOLA polar DEMs (size and SHA-256 verified),
cache them under .cache/lola/ and build browser terrain regions under
public/data/terrain/. The application lists every region in terrain/index.json in
its DEM area selector, so new regions appear after a reload.

Standard regions:
  --region=high-detail|wide-area|both   (default both)
  --product=ldem_875s_20m|ldem_80s_80m
  --size=<px>|WxH  (default 2048/2048 high-detail, 1024/1024 wide-area)
  --mpp=<m/px>

Custom local terrain (rectangular; centred on the pole unless --center-* is given):
  --extent-km=WxH|<km>                   e.g. --extent-km=400x300 or --extent-km=400
  --extent=<minX,minY,maxX,maxY>         projected metres, arbitrary rectangle
  --center-x=<m> --center-y=<m>          shift a --extent-km window off the pole
  --size=<px>|WxH                        output grid, e.g. --size=1024x768
  --mpp=<m/px>                           square pixels: width/height from the extent
  --id=<region-id>                       default custom-<W>x<H>km-<w>x<h>px

Other:
  --out-dir=<dir>   --cache-dir=<dir>   --force   --overwrite   --dry-run   --help

Examples:
  npm run data:lola
  npm run data:lola -- --region=high-detail --size=1024
  npm run data:lola -- --extent-km=400 --size=1024
  npm run data:lola -- --extent-km=400x300 --size=1024x768
  npm run data:lola -- --extent-km=400x300 --size=1024x768 --center-x=-50000 --center-y=40000
  npm run data:lola -- --extent=-200000,-300000,200000,300000 --mpp=400
  npm run data:lola -- --product=ldem_80s_80m --mpp=250
  npm run data:lola -- --dry-run
`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class UsageError extends Error {}

function log(message) {
  console.log(message)
}

function displayPath(file) {
  const resolved = path.resolve(file)
  const relative = path.relative(ROOT, resolved)
  return relative && !relative.startsWith('..') ? relative : resolved
}

function formatBytes(bytes) {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} kB`
  return `${bytes} B`
}

function formatKm(value) {
  const rounded = Math.round(value * 1000) / 1000
  return String(rounded).replace('.', 'p')
}

function sanitizeId(value) {
  const id = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!id) throw new UsageError(`invalid region id: "${value}"`)
  return id
}

function parseArgs(argv) {
  const args = { region: null, product: null, size: null, mpp: null, extent: null, extentKm: null, centerX: null, centerY: null, id: null, outDir: null, cacheDir: null, force: false, overwrite: false, dryRun: false, help: false }
  for (const token of argv) {
    if (token === '--help' || token === '-h') { args.help = true; continue }
    if (token === '--force') { args.force = true; continue }
    if (token === '--overwrite') { args.overwrite = true; continue }
    if (token === '--dry-run') { args.dryRun = true; continue }
    const match = token.match(/^--([a-z-]+)=(.*)$/i)
    if (!match) throw new UsageError(`unknown argument: ${token}`)
    const key = match[1]
    const value = match[2]
    switch (key) {
      case 'region': args.region = value; break
      case 'product': args.product = value; break
      case 'size': args.size = value; break
      case 'mpp': args.mpp = Number(value); break
      case 'extent': args.extent = value; break
      case 'extent-km': args.extentKm = value; break
      case 'center-x': args.centerX = Number(value); break
      case 'center-y': args.centerY = Number(value); break
      case 'id': args.id = value; break
      case 'out-dir': args.outDir = value; break
      case 'cache-dir': args.cacheDir = value; break
      default: throw new UsageError(`unknown option: --${key}`)
    }
  }
  return args
}

/** Parse "WxH" or a single number into a positive integer pair. */
function parseGridSpec(value, label) {
  const parts = String(value).trim().toLowerCase().split('x')
  if (parts.length > 2) throw new UsageError(`${label} must be a number or WxH (e.g. 1024x768)`)
  const numbers = parts.map((part) => Number(part))
  if (numbers.some((n) => !Number.isInteger(n) || n < 2)) {
    throw new UsageError(`${label} must contain integers of at least 2 pixels`)
  }
  return { width: numbers[0], height: numbers.length === 2 ? numbers[1] : numbers[0] }
}

/** Resolve the output grid (pixels) for an extent and the --size/--mpp options. */
function resolveGridSize(args, extent, defaultSize) {
  const widthM = extent.maxX - extent.minX
  const heightM = extent.maxY - extent.minY
  if (args.size != null) {
    const grid = parseGridSpec(args.size, '--size')
    return { ...grid, mppPixels: false }
  }
  if (args.mpp != null) {
    if (!Number.isFinite(args.mpp) || args.mpp <= 0) throw new UsageError('--mpp must be a positive number')
    return {
      width: Math.max(2, Math.round(widthM / args.mpp)),
      height: Math.max(2, Math.round(heightM / args.mpp)),
      mppPixels: true,
    }
  }
  if (typeof defaultSize === 'number') return { width: defaultSize, height: defaultSize, mppPixels: false }
  // Rectangular custom extent without --size/--mpp: keep the aspect ratio at 1024 px on the long side.
  if (widthM >= heightM) {
    return { width: 1024, height: Math.max(2, Math.round((1024 * heightM) / widthM)), mppPixels: false }
  }
  return { width: Math.max(2, Math.round((1024 * widthM) / heightM)), height: 1024, mppPixels: false }
}

/** True when both output axes have the same pixel size (within rounding). */
function isSquarePixelGrid(extent, grid) {
  const pixelX = (extent.maxX - extent.minX) / grid.width
  const pixelY = (extent.maxY - extent.minY) / grid.height
  return Math.abs(pixelX - pixelY) <= 1e-3 * Math.max(pixelX, pixelY)
}

function parseExtent(value) {
  const parts = String(value).split(',').map((part) => Number(part.trim()))
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new UsageError('--extent must be four numbers: minX,minY,maxX,maxY (projected metres)')
  }
  return { minX: parts[0], minY: parts[1], maxX: parts[2], maxY: parts[3] }
}

function validateExtent(extent) {
  const { minX, minY, maxX, maxY } = extent
  if (!(minX < maxX && minY < maxY)) throw new UsageError('extent must satisfy minX < maxX and minY < maxY')
  return { widthM: maxX - minX, heightM: maxY - minY }
}

/** Parse "--extent-km=WxH" or "--extent-km=<km>" (square) into kilometre sizes. */
function parseExtentKmSpec(value) {
  const parts = String(value).trim().toLowerCase().split('x')
  if (parts.length > 2) throw new UsageError('--extent-km must be a number or WxH in kilometres (e.g. 400x300)')
  const numbers = parts.map((part) => Number(part))
  if (numbers.some((n) => !Number.isFinite(n) || n <= 0)) {
    throw new UsageError('--extent-km values must be positive numbers of kilometres')
  }
  return { widthKm: numbers[0], heightKm: numbers.length === 2 ? numbers[1] : numbers[0] }
}

function productCoverageError(extent) {
  const coverages = PRODUCT_ORDER.map((key) => {
    const product = PRODUCTS[key]
    return `${key} covers plus/minus ${product.coverageM.toFixed(0)} m`
  }).join('; ')
  return new UsageError(
    `requested extent [${extent.minX},${extent.minY},${extent.maxX},${extent.maxY}] does not fit a LOLA product (${coverages})`,
  )
}

function selectProductForExtent(extent) {
  for (const key of PRODUCT_ORDER) {
    const product = PRODUCTS[key]
    const c = product.coverageM
    if (extent.minX >= -c && extent.minY >= -c && extent.maxX <= c && extent.maxY <= c) return product
  }
  throw productCoverageError(extent)
}

/** Human label for one dimension pair, e.g. "400km" or "400x300km". */
function dimensionLabel(a, b, unit, format) {
  return a === b ? `${format(a)}${unit}` : `${format(a)}x${format(b)}${unit}`
}

/** Resolve CLI arguments into download candidates and build jobs. */
function resolvePlan(args) {
  if (args.help) return { help: true }
  if (args.region != null && args.product != null) throw new UsageError('use either --region or --product, not both')
  if (args.size != null && args.mpp != null) throw new UsageError('use either --size or --mpp, not both')
  if (args.region != null && !['high-detail', 'wide-area', 'both'].includes(args.region)) {
    throw new UsageError('--region must be high-detail, wide-area or both')
  }
  if (args.product != null && !PRODUCTS[args.product]) {
    throw new UsageError(`--product must be one of: ${Object.keys(PRODUCTS).join(', ')}`)
  }

  const custom = args.extent != null || args.extentKm != null
  if (custom && (args.region != null || args.product != null)) {
    throw new UsageError('--extent-km/--extent cannot be combined with --region/--product; the product is selected from the extent')
  }

  const outDir = args.outDir ? path.resolve(args.outDir) : DEFAULT_OUT
  const cacheDir = args.cacheDir ? path.resolve(args.cacheDir) : DEFAULT_CACHE
  const jobs = []
  const productKeys = new Set()

  if (custom) {
    let extent
    let extentLabel
    const cx = args.centerX ?? 0
    const cy = args.centerY ?? 0
    if (args.extentKm != null) {
      const km = parseExtentKmSpec(args.extentKm)
      const halfW = (km.widthKm * 1000) / 2
      const halfH = (km.heightKm * 1000) / 2
      extent = { minX: cx - halfW, minY: cy - halfH, maxX: cx + halfW, maxY: cy + halfH }
      extentLabel = dimensionLabel(km.widthKm, km.heightKm, 'km', formatKm)
    } else {
      if (args.centerX != null || args.centerY != null) throw new UsageError('--center-x/--center-y cannot be combined with --extent; use --extent-km')
      extent = parseExtent(args.extent)
      const { widthM, heightM } = validateExtent(extent)
      extentLabel = dimensionLabel(widthM / 1000, heightM / 1000, 'km', formatKm)
    }
    const { widthM, heightM } = validateExtent(extent)
    const product = selectProductForExtent(extent)
    const grid = resolveGridSize(args, extent, null)
    const sizeLabel = dimensionLabel(grid.width, grid.height, 'px', String)
    const compact = widthM === heightM && grid.width === grid.height
    const centerX = (extent.minX + extent.maxX) / 2
    const centerY = (extent.minY + extent.maxY) / 2
    // Encode an off-pole centre in the id so two windows of the same size do not collide.
    const centerSuffix =
      Math.abs(centerX) > 0.5 || Math.abs(centerY) > 0.5
        ? `-cx${formatKm(centerX / 1000)}km-cy${formatKm(centerY / 1000)}km`
        : ''
    const id = args.id
      ? sanitizeId(args.id)
      : (compact
          ? `custom-${formatKm(widthM / 1000)}km-${grid.width}px`
          : `custom-${formatKm(widthM / 1000)}x${formatKm(heightM / 1000)}km-${grid.width}x${grid.height}px`) +
        centerSuffix
    const name = compact
      ? `Custom LOLA south-pole terrain, ${formatKm(widthM / 1000)} km at ${grid.width} px (LOLA ${product.label})`
      : `Custom LOLA south-pole terrain, ${formatKm(widthM / 1000)} x ${formatKm(heightM / 1000)} km at ${grid.width} x ${grid.height} px (LOLA ${product.label})`
    productKeys.add(product.key)
    jobs.push({ mode: 'custom', product, grid, extent, id, name, role: 'custom' })
  } else {
    let keys
    if (args.region === 'both' || (args.region == null && args.product == null)) keys = [...PRODUCT_ORDER]
    else if (args.region != null) keys = [REGION_ALIASES[args.region]]
    else keys = [args.product]
    for (const key of keys) {
      const product = PRODUCTS[key]
      const extent = {
        minX: -product.coverageM,
        minY: -product.coverageM,
        maxX: product.coverageM,
        maxY: product.coverageM,
      }
      const grid = resolveGridSize(args, extent, product.defaultSize)
      productKeys.add(key)
      jobs.push({
        mode: 'standard',
        product,
        grid,
        extent,
        id: product.standardRegion.id,
        name: product.standardRegion.name,
        role: product.standardRegion.role,
      })
    }
  }

  return {
    help: false,
    outDir,
    cacheDir,
    force: args.force,
    overwrite: args.overwrite,
    dryRun: args.dryRun,
    products: [...productKeys].map((key) => PRODUCTS[key]),
    jobs,
  }
}

async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function verifyProductFile(file, product) {
  try {
    const info = await stat(file)
    if (info.size !== product.bytes) return { ok: false, reason: `size ${info.size} != ${product.bytes}` }
    const sha256 = await hashFile(file)
    if (sha256 !== product.sha256) return { ok: false, reason: `sha256 ${sha256} != ${product.sha256}` }
    return { ok: true, bytes: info.size, sha256 }
  } catch (error) {
    return { ok: false, reason: error.message }
  }
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/octet-stream' },
        signal: AbortSignal.timeout(300_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
      return response
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        log(`  download attempt ${attempt}/${attempts} failed (${error.message}); retrying in ${attempt * 2}s`)
        await sleep(attempt * 2000)
      }
    }
  }
  throw new Error(`download failed after ${attempts} attempts: ${lastError.message}`)
}

async function ensureProduct(product, plan) {
  await mkdir(plan.cacheDir, { recursive: true })
  const target = path.join(plan.cacheDir, product.file)

  if (!plan.force && existsSync(target)) {
    const check = await verifyProductFile(target, product)
    if (check.ok) {
      log(`cache hit ${product.file}: ${formatBytes(check.bytes)}, sha256 ${check.sha256}`)
      return { path: target, status: 'cached', bytes: check.bytes, sha256: check.sha256 }
    }
    log(`cached ${product.file} failed verification (${check.reason}); re-downloading`)
  }

  const url = `${BASE_URL}${product.file}`
  const tmp = `${target}.part`
  await rm(tmp, { force: true })
  log(`downloading ${product.file} (${formatBytes(product.bytes)}) from PDS Geosciences`)
  const response = await fetchWithRetry(url)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tmp))

  const info = await stat(tmp)
  if (info.size !== product.bytes) {
    await rm(tmp, { force: true })
    throw new Error(`${product.file}: downloaded ${info.size} B, expected ${product.bytes} B`)
  }
  const sha256 = await hashFile(tmp)
  if (sha256 !== product.sha256) {
    await rm(tmp, { force: true })
    throw new Error(`${product.file}: sha256 ${sha256}, expected ${product.sha256}`)
  }
  await rename(tmp, target)
  log(`verified ${product.file}: ${info.size} B, sha256 ${sha256}`)
  return { path: target, status: 'downloaded', bytes: info.size, sha256 }
}

function checkRasterio() {
  const result = spawnSync('python3', ['-c', 'import rasterio; print(rasterio.__version__)'], { encoding: 'utf8' })
  if (result.error) throw new Error(`python3 is not available: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(
      'python3 is available but rasterio is not installed; install it with: python3 -m pip install --user rasterio',
    )
  }
  return result.stdout.trim()
}

function runHelper(job, plan, sourcePath, stagedBin, stagedMeta) {
  const args = [
    HELPER,
    '--source', sourcePath,
    '--out-bin', stagedBin,
    '--out-meta', stagedMeta,
    '--bin-name', `${job.id}.bin`,
    '--id', job.id,
    '--name', job.name,
    '--role', job.role,
    '--width', String(job.grid.width),
    '--height', String(job.grid.height),
    '--min-x', String(job.extent.minX),
    '--min-y', String(job.extent.minY),
    '--max-x', String(job.extent.maxX),
    '--max-y', String(job.extent.maxY),
  ]
  const result = spawnSync('python3', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.error) throw new Error(`could not run the rasterio helper: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`rasterio helper failed (exit ${result.status}):\n${(result.stderr || result.stdout || '').trim()}`)
  }
  const lines = String(result.stdout).trim().split('\n')
  try {
    return JSON.parse(lines[lines.length - 1])
  } catch {
    throw new Error(`could not parse rasterio helper output: ${result.stdout}`)
  }
}

function buildIndexEntry(meta) {
  const entry = {
    id: meta.id,
    role: meta.role,
    meta: `${meta.id}.json`,
    bin: meta.grid.file,
    width: meta.grid.width,
    height: meta.grid.height,
    pixelSizeM: meta.grid.pixelSizeM,
    boundsM: {
      minX: meta.grid.minX,
      maxX: meta.grid.maxX,
      minY: meta.grid.minY,
      maxY: meta.grid.maxY,
    },
    elevationRangeM: meta.elevationRangeM,
  }
  // Custom grids also record the per-axis pixel size when the output is not square.
  if (Number.isFinite(Number(meta.grid.pixelSizeXM)) && Number.isFinite(Number(meta.grid.pixelSizeYM))) {
    entry.pixelSizeXM = meta.grid.pixelSizeXM
    entry.pixelSizeYM = meta.grid.pixelSizeYM
    entry.squarePixels = meta.grid.squarePixels === true
    // Bounds also as lower/upper corner strings: the UI region label reads these to
    // show "Custom W x H km at N m/px" for non-standard regions.
    entry.boundsM.lower = `${entry.boundsM.minX} ${entry.boundsM.minY}`
    entry.boundsM.upper = `${entry.boundsM.maxX} ${entry.boundsM.maxY}`
  }
  return entry
}

async function buildRegion(job, plan, sourcePath) {
  const stagedBin = path.join(plan.outDir, `.${job.id}.bin.part`)
  const stagedMeta = path.join(plan.outDir, `.${job.id}.json.part`)
  const binPath = path.join(plan.outDir, `${job.id}.bin`)
  const metaPath = path.join(plan.outDir, `${job.id}.json`)

  const pixelX = (job.extent.maxX - job.extent.minX) / job.grid.width
  const pixelY = (job.extent.maxY - job.extent.minY) / job.grid.height
  if (!isSquarePixelGrid(job.extent, job.grid)) {
    log(
      `  note: non-square output pixels (${pixelX.toFixed(3)} m x ${pixelY.toFixed(3)} m); ` +
        'the analysis core assumes one pixel size, so prefer --mpp or a proportional --size for analysis-grade regions',
    )
  }
  log(
    `building ${job.id}: ${job.grid.width}x${job.grid.height} px from ${job.product.file} ` +
      `(${displayPath(plan.outDir)})`,
  )
  try {
    const summary = runHelper(job, plan, sourcePath, stagedBin, stagedMeta)
    const sha256 = await hashFile(stagedBin)
    const indexEntry = buildIndexEntry(JSON.parse(await readFile(stagedMeta, 'utf8')))

    if (existsSync(binPath)) {
      const previous = await hashFile(binPath)
      if (previous !== sha256) {
        if (!plan.overwrite) {
          throw new Error(
            `refusing to replace ${path.basename(binPath)}: new bytes differ from the existing grid ` +
              `(existing ${previous}, new ${sha256}); re-run with --overwrite if this change is intended`,
          )
        }
        log(`  overwriting ${job.id}.bin (bytes changed; --overwrite given)`)
      }
    }

    await rename(stagedBin, binPath)
    await rename(stagedMeta, metaPath)
    const info = await stat(binPath)
    log(
      `  wrote ${job.id}.bin: ${formatBytes(info.size)}, ` +
        `${summary.width}x${summary.height} px, ` +
        (summary.squarePixels
          ? `${summary.pixelSizeM} m/px`
          : `${summary.pixelSizeXM} m/px (x) x ${summary.pixelSizeYM} m/px (y)`) +
        `, bounds [${summary.boundsM.minX},${summary.boundsM.minY},${summary.boundsM.maxX},${summary.boundsM.maxY}] m, ` +
        `elevation ${summary.elevationRangeM[0]}..${summary.elevationRangeM[1]} m, sha256 ${sha256}`,
    )
    return {
      id: job.id,
      mode: job.mode,
      product: job.product.key,
      bin: displayPath(binPath),
      meta: displayPath(metaPath),
      bytes: info.size,
      sha256,
      width: summary.width,
      height: summary.height,
      pixelSizeM: summary.pixelSizeM,
      pixelSizeXM: summary.pixelSizeXM,
      pixelSizeYM: summary.pixelSizeYM,
      squarePixels: summary.squarePixels,
      boundsM: summary.boundsM,
      elevationRangeM: summary.elevationRangeM,
      indexEntry,
    }
  } finally {
    await rm(stagedBin, { force: true })
    await rm(stagedMeta, { force: true })
  }
}

async function readJsonIfExists(file) {
  if (!existsSync(file)) return null
  return JSON.parse(await readFile(file, 'utf8'))
}

async function updateIndex(plan, builtRegions) {
  const indexPath = path.join(plan.outDir, 'index.json')
  const existing = await readJsonIfExists(indexPath)
  const repoIndex = path.resolve(plan.outDir) === path.resolve(REPO_TERRAIN) ? null : await readJsonIfExists(REPO_INDEX)
  const base = existing ?? repoIndex ?? {
    id: 'lunar-south-pole-terrain',
    referenceRadiusM: REFERENCE_RADIUS_M,
    projection: DEFAULT_PROJECTION,
    defaultRegionId: null,
    regions: [],
    attribution: ATTRIBUTION,
  }

  const regions = Array.isArray(base.regions) ? base.regions.map((region) => ({ ...region })) : []
  for (const region of builtRegions) {
    const position = regions.findIndex((entry) => entry.id === region.indexEntry.id)
    if (position >= 0) regions[position] = region.indexEntry
    else regions.push(region.indexEntry)
  }
  const defaultRegionId =
    base.defaultRegionId && regions.some((region) => region.id === base.defaultRegionId)
      ? base.defaultRegionId
      : (regions.find((region) => region.id === 'south-pole-875s-20m')?.id ?? regions[0]?.id ?? null)
  const nextIndex = {
    id: base.id ?? 'lunar-south-pole-terrain',
    referenceRadiusM: base.referenceRadiusM ?? REFERENCE_RADIUS_M,
    projection: base.projection ?? DEFAULT_PROJECTION,
    defaultRegionId,
    regions,
    attribution: base.attribution ?? ATTRIBUTION,
  }

  const unchanged = existing != null && JSON.stringify(existing) === JSON.stringify(nextIndex)
  if (!unchanged) {
    await mkdir(plan.outDir, { recursive: true })
    await writeFile(indexPath, JSON.stringify(nextIndex, null, 2) + '\n', 'utf8')
  }
  log(
    unchanged
      ? `index ${displayPath(indexPath)} unchanged (${regions.length} regions, default ${defaultRegionId})`
      : `updated ${displayPath(indexPath)}: ${regions.length} regions, default ${defaultRegionId}`,
  )
  return { path: indexPath, changed: !unchanged, regions, defaultRegionId }
}

function printPlan(plan) {
  log('LOLA local DEM plan')
  log(`  cache:   ${plan.cacheDir}${existsSync(plan.cacheDir) ? '' : ' (will be created)'}`)
  log(`  output:  ${plan.outDir}`)
  for (const product of plan.products) {
    const cached = existsSync(path.join(plan.cacheDir, product.file))
    log(
      `  product ${product.file}: ${cached ? 'cached, will verify' : 'will download'} ` +
        `(${formatBytes(product.bytes)}, sha256 ${product.sha256.slice(0, 16)}...)`,
    )
  }
  for (const job of plan.jobs) {
    log(
      `  region  ${job.id}: ${job.grid.width}x${job.grid.height} px from ${job.product.file}, ` +
        `extent [${job.extent.minX},${job.extent.minY},${job.extent.maxX},${job.extent.maxY}] m -> ` +
        `${path.join(plan.outDir, `${job.id}.bin`)}, ${path.join(plan.outDir, `${job.id}.json`)}`,
    )
  }
  log(`  index:   ${path.join(plan.outDir, 'index.json')}`)
  log('dry run: no downloads and no files written')
}

async function main() {
  let plan
  try {
    plan = resolvePlan(parseArgs(process.argv.slice(2)))
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`error: ${error.message}\n`)
      console.error(USAGE)
      process.exitCode = 1
      return
    }
    throw error
  }
  if (plan.help) {
    console.log(USAGE)
    return
  }
  if (plan.dryRun) {
    printPlan(plan)
    return
  }

  await mkdir(plan.outDir, { recursive: true })
  const python = checkRasterio()
  log(`rasterio ${python}; ${plan.products.length} product(s), ${plan.jobs.length} region(s)`)

  const cacheEvidence = []
  for (const product of plan.products) {
    const result = await ensureProduct(product, plan)
    cacheEvidence.push({ product: product.file, status: result.status, bytes: result.bytes, sha256: result.sha256 })
  }

  const builtRegions = []
  for (const job of plan.jobs) {
    const cachePath = path.join(plan.cacheDir, job.product.file)
    builtRegions.push(await buildRegion(job, plan, cachePath))
  }

  const index = await updateIndex(plan, builtRegions)
  const summary = {
    outDir: plan.outDir,
    cacheDir: plan.cacheDir,
    products: cacheEvidence,
    regions: builtRegions.map((region) => ({
      id: region.id,
      mode: region.mode,
      product: region.product,
      bin: region.bin,
      meta: region.meta,
      bytes: region.bytes,
      sha256: region.sha256,
      width: region.width,
      height: region.height,
      pixelSizeM: region.pixelSizeM,
      pixelSizeXM: region.pixelSizeXM,
      pixelSizeYM: region.pixelSizeYM,
      squarePixels: region.squarePixels,
      boundsM: region.boundsM,
      elevationRangeM: region.elevationRangeM,
    })),
    index: { path: displayPath(index.path), changed: index.changed, regions: index.regions.length, defaultRegionId: index.defaultRegionId },
    note: 'The application lists every region in terrain/index.json in its DEM area selector; reload it to see new regions.',
  }
  log('summary')
  log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(`error: ${error.message}`)
  process.exitCode = 1
})
